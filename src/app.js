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
app.get('/contracts/:id', getProfile, async (req, res) => {
  const { Contract } = req.app.get('models')
  const { id } = req.params
  const profileId = req.profile.id
  const contract = await Contract.findOne({ where: { id } })
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
        paid: false
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
          paid: false,
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

module.exports = app
