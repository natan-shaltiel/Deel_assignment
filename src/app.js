const express = require('express');
const bodyParser = require('body-parser');
const {sequelize} = require('./model')
const {getProfile} = require('./middleware/getProfile')
const app = express();
app.use(bodyParser.json());
app.set('sequelize', sequelize)
app.set('models', sequelize.models)

/**
 * FIX ME!
 * @returns contract by id
 */
app.get('/contracts/:id',getProfile ,async (req, res) =>{
    const {Contract} = req.app.get('models')
    const {id} = req.params
    let contract;
    if (id == req.profile.id) { 
        //using == as we want to compare string to an int (and I didn't see the need to parse it)
        contract = await Contract.findOne({where: {id}})
    }
    
    if(!contract) return res.status(404).end()
    res.json(contract)
})
module.exports = app;
