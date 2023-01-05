const express = require('express');
const bodyParser = require('body-parser');
const {sequelize} = require('./model')
const {getProfile} = require('./middleware/getProfile')
const app = express();
app.use(bodyParser.json());
app.set('sequelize', sequelize)
app.set('models', sequelize.models)

const { Sequelize } = require('sequelize');

const TERMINATED_CONTRACT = 'terminated';

/**
 * FIX ME!
 * @returns contract by id
 */
app.get('/contracts/:id',getProfile ,async (req, res) =>{
    const {Contract} = req.app.get('models')
    const {id} = req.params
    let contract;
    const profileId = req.profile.id
    contract = await Contract.findOne({where: {id}})
    if(!contract || (contract.ContractorId != profileId && contract.ClientId != profileId)) return res.status(404).end()
    res.json(contract)
})

const getContractsQueryForId = (id) => {
    return {        
        where: {
          [Sequelize.Op.or]: [
            { ClientId:id },
            { ContractorId:id}   
          ],
          status: {[Sequelize.Op.ne]: TERMINATED_CONTRACT}
        }
    }
}

app.get('/contracts/',getProfile ,async (req, res) =>{
    const {Contract} = req.app.get('models')
    const id = req.profile.id;
    let results;

    try {
        const query = getContractsQueryForId(id);

        results = await Contract.findAll(query);

    } catch (err ) {
        console.log(err);
    }
    if (!results || results.length == 0) {
        return res.status(404).end()
    }
    res.json(results);
    
})

app.get('/jobs/unpaid',getProfile ,async (req, res) =>{
    const {Contract,Job} = req.app.get('models')
    const id = req.profile.id;
    let results;
    const contractQuery = getContractsQueryForId(id);

    try {
        //TODO: refactor move the where statement of Contract to a joint structure with the previous query
        results = await Job.findAll({
            include: [{
                model: Contract,
                attributes: [],
                where: contractQuery.where
            }],
            where: {
              paid: false,
            }
        })

    } catch (err ) {
        console.log(err);
    }
    if (!results || results.length == 0) {
        return res.status(404).end()
    }
    res.json(results);
    
})

app.post('/jobs/pay',getProfile ,async (req, res) =>{
    const {Contract,Job} = req.app.get('models')
    const id = req.profile.id;
    let results;

});

module.exports = app;
