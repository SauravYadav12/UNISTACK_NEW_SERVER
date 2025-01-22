const mongoose = require('mongoose');


const teams = new mongoose.Schema({
    teamId:{
        type: Number,
        unique: true
    },
    teamName: {
        type: String,
    },
    contactPerson:{
        type:String,
    },
    phone:{
        type:String,
    },
    createdBy: {
        type: String,
    },
    createdAt:{
        type: Date,
    },
    updatedAt: {
        type: String,
    },
  },
  {
    timestamps: true
  });


  const Teams = mongoose.model('Teams',teams);

  module.exports = Teams;