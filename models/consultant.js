const mongoose = require('mongoose');


const consultant = new mongoose.Schema({
    consultantId:{
        type: Number,
        unique: true
    },
    consultantName: {
        type: String,
    },
    consultantStatus:{
        type:String,
    },
    visaStatus: {
        type: String,
    },
    currentAddress: {
        type: String,
    },  
    previousAddress:{
        type: String,
    },
    email:{
        type:String,
    },
    phone:{
        type:String,
    },
    skypeId:{
        type:String
    },
    dob: {
        type: Date,
    },
    ssn: {
        type: String,
    },
    dlNo: {
        type: String,
    },
    degree: {
        type: String,
    },
    university: {
        type: String,
    },
    yearPassing: {
        type: String,
    },
    timeZone: {
        type: String,
    },
    projects: [
        {
          projectNumber: { type: String },
          projectName: { type: String },
          projectCity: { type: String },
          projectState: { type: String },
          projectStartDate: { type: Date },
          projectEndDate: { type: Date },
          projectDescription: { type: String },
        },
      ],
    psuedoName:{
        type:String
    },
    getVisa:{
        type: String
    },
    cameToUsYear:{
        type:String
    },
    originCountry:{
        type: String
    },
    lookingToChange:{
        type:String
    },
    createdBy: {
        type: String,
    },
    updatedBy: {
        type: String,
    },
  },
  {
    timestamps: true
  });


  const Consultant = mongoose.model('Consultant',consultant);

  module.exports = Consultant;


