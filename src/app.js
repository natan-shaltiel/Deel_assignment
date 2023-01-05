/* eslint-disable eqeqeq */
const express = require('express')
const bodyParser = require('body-parser')
const { sequelize } = require('./model')
const { getProfile } = require('./middleware/getProfile')
const app = express()
app.use(bodyParser.json())
app.set('sequelize', sequelize)
app.set('models', sequelize.models)

const { Sequelize } = require('sequelize')

const TERMINATED_CONTRACT = 'terminated'

/**
 * FIX ME!
 * @returns contract by id
 */
// curl -v localhost:3001/contracts/2 -H 'profile_id: 1'
// curl -v localhost:3001/contracts/3 -H 'profile_id: 1'
app.get('/contracts/:id', getProfile, async (req, res) => {
  const { Contract } = req.app.get('models')
  const { id } = req.params
  const profileId = req.profile.id
  const contract = await Contract.findOne({ where: { id } })
  // purposefully sending "not found" as it is more secure than letting them know that there is one and they are not authorized
  if (!contract || (contract.ContractorId != profileId && contract.ClientId != profileId)) return res.status(404).end()
  res.json(contract)
})

const getContractsQueryForId = (id) => {
  return {
    where: {
      [Sequelize.Op.or]: [
        { ClientId: id },
        { ContractorId: id }
      ],
      status: { [Sequelize.Op.ne]: TERMINATED_CONTRACT }
    }
  }
}

// curl -v localhost:3001/contracts/ -H 'profile_id: 1'
app.get('/contracts/', getProfile, async (req, res) => {
  const { Contract } = req.app.get('models')
  const id = req.profile.id
  let results

  try {
    const query = getContractsQueryForId(id)

    results = await Contract.findAll(query)
  } catch (err) {
    console.log(err)
  }
  if (!results || results.length === 0) {
    return res.status(404).end()
  }
  res.json(results)
})

// curl -X GET -v localhost:3001/jobs/unpaid -H 'profile_id: 2'
app.get('/jobs/unpaid', getProfile, async (req, res) => {
  const { Contract, Job } = req.app.get('models')
  const id = req.profile.id
  let results
  const contractQuery = getContractsQueryForId(id)

  try {
    // TODO: refactor move the where statement of Contract to a joint structure with the previous query
    results = await Job.findAll({
      include: [{
        model: Contract,
        attributes: [],
        where: contractQuery.where
      }],
      where: {
        [Sequelize.Op.or]: [
          { paid: false },
          { paid: null }
        ]
      }
    })
  } catch (err) {
    console.log(err)
  }
  if (!results || results.length == 0) {
    return res.status(404).end()
  }
  res.json(results)
})

function updateClientBalance (clientId, balance, req) {
  const { Profile } = req.app.get('models')
  return Profile.update({
    balance
  }, {
    where: {
      id: clientId
    }
  })
}

// curl -X POST -v localhost:3001/jobs/14/pay -H 'profile_id: 6'
// curl -X POST -v localhost:3001/jobs/4/pay -H 'profile_id: 2'
app.post('/jobs/:jobId/pay', getProfile, async (req, res) => {
  const { Contract, Job, Profile } = req.app.get('models')
  const id = req.profile.id
  const { jobId } = req.params
  const contractQuery = getContractsQueryForId(id)
  let success = false
  // TODO: I would have probably optimized it but trying to stick to the timeline
  try {
    await sequelize.transaction(async transaction => {
      // TODO: I should grab the profiles of both client and contractor with this fetch (need to learn how)
      const job = await Job.findOne({
        include: [{
          model: Contract,
          attributes: ['ClientId', 'ContractorId'],
          where: contractQuery.where
        }
        ],
        where: {
          [Sequelize.Op.or]: [
            { paid: false },
            { paid: null }
          ],
          id: jobId
        }
      })
      if (!job || job.Contract.ClientId != id) return // I am not the client
      const profile = await Profile.findOne({ where: { id } })
      if (!profile || profile.balance < job.price) return
      const contractorProfile = await Profile.findOne({ where: { id: job.Contract.ContractorId } })
      if (!contractorProfile) return
      console.log(`client: ${profile.id} balance:${profile.balance}, contractor:${contractorProfile.id}, balance:${contractorProfile.balance}`)
      const updateJob = Job.update(
        {
          paid: true
        }, {
          where: {
            id: jobId
          }
        })
      const clientPromise = updateClientBalance(id, profile.balance - job.price, req)
      const contractorPromise = updateClientBalance(contractorProfile.id, contractorProfile.balance + job.price, req)
      await Promise.all([updateJob, clientPromise, contractorPromise])
      console.log('success')
      success = true
    })
  } catch (err) {
    console.log('error')
    success = false
  }
  // TODO: I would add reason
  if (success) {
    return res.status(200).end()
  } else {
    return res.status(400).end()
  }
})

// curl -X POST -v localhost:3001/balances/deposit/1 -H 'profile_id: 1' -H 'Content-Type: application/json; charset=utf-8'  -d '{"amount": 100}'
app.post('/balances/deposit/:userId', getProfile, async (req, res) => {
  console.log(req.body)
  const amount = req?.body?.amount
  if (!amount || isNaN(amount)) {
    return res.status(400).end()
  }
  const { userId } = req.params
  if (userId != req.profile.id) {
    return res.status(401).end()
  }
  let success = false
  try {
    await sequelize.transaction(async transaction => {
    // I tried making sequelize work but it took too long to figure out the syntax for association between tables with multiple associations
    // TODO: try again later if I can find the time

      // I'm including non terminated contracts - I'm not sure what was the requirement so I don't want to be restrictive
      const seqQResult = await sequelize.query(`
      SELECT SUM(j.price) as total_price, p.id as clientId, p.balance as balance       
      FROM Profiles as p, Contracts as c, Jobs as j
      where j.ContractId = c.id and p.id = c.ClientId and p.id = ${userId} and (j.paid IS NULL OR j.paid = 0)
      
      `)
      //
      console.log(JSON.stringify(seqQResult, null, 4))
      let totalPrice
      let balance
      if (seqQResult?.length && seqQResult[0]?.length) {
        totalPrice = seqQResult[0][0].total_price
        balance = seqQResult[0][0].balance
      }
      if (totalPrice && totalPrice / 4 >= amount) {
        await updateClientBalance(userId, balance + amount, req)
        success = true
      }
    })
  } catch (err) {
    console.log(err)
  }
  if (success) {
    return res.status(200).end()
  } else {
    return res.status(400).end()
  }
})

// curl -X GET -v "localhost:3001/admin/best-profession?start=2020-01-15&end=2022-08-15" -H 'profile_id: 1'
// curl -X GET -v "localhost:3001/admin/best-profession?start=2022-08-16&end=2022-08-17" -H 'profile_id: 1'
// curl -X GET -v "localhost:3001/admin/best-profession?start=2020-08-10&end=2020-08-11" -H 'profile_id: 1'
app.get('/admin/best-profession', getProfile, async (req, res) => {
  // eslint-disable-next-line no-unused-vars
  const { Contract, Job, Profile } = req.app.get('models')
  const start = new Date(req.query.start)
  const end = new Date(req.query.end)
  if (isNaN(start) || isNaN(end)) {
    return res.status(400).end()
  }
  console.log(`start: ${start}, end: ${end}`)
  console.log(sequelize)
  let seqQResult
  try {
    // j.id as jobId , j.price as price, j.paid as paid , c.id as contractId p.id as profileId p.profession as proffesion
    // TODO: while my check above minimizes the possibilty for sql injection - I would still double check here...
    seqQResult = await sequelize.query(`
        SELECT SUM(j.price) as total_price, p.profession as profession       
        FROM Profiles as p, Contracts as c, Jobs as j
        where j.ContractId = c.id and p.id = c.ContractorId and j.paid = true and j.paymentDate >= "${req.query.start}" and j.paymentDate <= "${req.query.end}"
        GROUP BY p.profession
        ORDER BY total_price DESC
        LIMIT 1`)
    console.log(JSON.stringify(seqQResult, null, 4))
    if (seqQResult && seqQResult[0] && seqQResult[0].length && seqQResult[0][0]) {
      res.json(seqQResult[0][0].profession)
      return
    }
  } catch (err) {
    console.log(err)
  }
  return res.status(404).end()
})

/*
    //I tried making sequelize work but it took too long to figure out the syntax for association between tables with multiple associations
    //TODO: try again later if I can find the time
    // I could have pulled an aggregate of contracts and then process on the client but it is never a good idea with databases
    //My solution above is still not very good because it might be brittle if we change DB for example and the syntax would be different
    const results = await Job.findAll({
      include: [{
        model: Contract,
        attributes: ['ContractorId', [Sequelize.col('id'), 'profileId']],
        foreignKey: 'ContractId',
        include: [{
          model: Profile,
          attributes: ['profession'],
          where: { profileId: Sequelize.col('ContractorId') }
        }]
      }
      ],
      attributes: [[Sequelize.fn('SUM', Sequelize.col('price')), 'total_price'], 'ContractId'],
      where: {
        paid: true
      },
      order: [[Sequelize.col('total_price'), 'DESC']],
      group: ['ContractId']
    })
    console.log(JSON.stringify(results, null, 4))
    */

// Task 7:
// copy pasting because I'm tired :) will refactor later
// curl -X GET -v "localhost:3001/admin/best-clients?start=2020-08-16&end=2020-08-17&limit=10" -H 'profile_id: 1'
// curl -X GET -v "localhost:3001/admin/best-clients?start=2020-01-16&end=2022-08-17&limit=10" -H 'profile_id: 1'
app.get('/admin/best-clients', getProfile, async (req, res) => {
  // eslint-disable-next-line no-unused-vars
  const { Contract, Job, Profile } = req.app.get('models')
  const start = new Date(req.query.start)
  const end = new Date(req.query.end)
  if (isNaN(start) || isNaN(end)) {
    return res.status(400).end()
  }
  let limit = req.query.limit
  if (!limit || isNaN(limit)) limit = 2

  console.log(`start: ${start}, end: ${end} limit: ${limit}`)
  console.log(sequelize)
  let seqQResult
  try {
    // j.id as jobId , j.price as price, j.paid as paid , c.id as contractId p.id as profileId p.profession as proffesion
    // TODO: while my check above minimizes the possibilty for sql injection - I would still double check here...
    seqQResult = await sequelize.query(`
          SELECT p.id as id, j.price as paid, p.firstName as fName, p.lastName as lName
          FROM Profiles as p, Contracts as c, Jobs as j
          where j.ContractId = c.id and p.id = c.ClientId and j.paid = true and j.paymentDate >= "${req.query.start}" and j.paymentDate <= "${req.query.end}"
          ORDER BY j.price DESC
          LIMIT ${limit}`)
    console.log(JSON.stringify(seqQResult, null, 4))
    if (seqQResult && seqQResult[0] && seqQResult[0].length && seqQResult[0]) {
      for (const currClient of seqQResult[0]) {
        currClient.fullName = `${currClient.fName} ${currClient.lName}`
        delete currClient.fName
        delete currClient.lName
      }
      res.json(seqQResult[0])
      return
    }
  } catch (err) {
    console.log(err)
  }
  return res.status(404).end()
})
module.exports = app
// First Release Jan 5 (for empty commit)
