const mongoose = require('mongoose');
const User = require("./user");
const interviewSchema = new mongoose.Schema(
    {
      intId: {
        type: String,
        unique: true,
        default: () => `INT-${new Date().getTime()}`
      },
      interviewDate: {
        type: String
      },
      interviewTime: {
        type: String
      },
      interviewType: {
        type: String
      },
      interviewStatus: {
        type: String
      },
      intResult: {
        type: String
      },
      consultant: {
        type: String
      },
      marketingPerson: {
        type: String
      },
      marketingPersonRef: {
      required: true,
      type: mongoose.Schema.Types.ObjectId,
      ref: User,
      },
      vendorCompany: {
        type: String
      },
      primeVendorCompany: {
        type: String
      },
      tentativeReason: {
        type: String
      },
      gitHubLink: {
        type: String
      },
      codeLink: {
        type: String
      },
      result: {
        type: String
      },
      subjectLine: {
        type: String
      },
      interviewMode: {
        type: String
      },
      interviewLink: {
        type: String
      },
      interviewFocus: {
        type: String
      },
      jobDescription: {
        type: String
      },
      interviewFeedback: {
        type: String
      },
      taxType: {
        type: Array
      },
      clientName: {
        type: String
      },
      duration: {
        type: Array
      },
      candidateName: {
        type: String
      },
      rateForInterview: {
        type: String
      },
      paymentStatus: {
        type: String
      },
      recordOwner: {
        type: String
      },
      reqID: {
        type: String
      },
      recordId: {
        type: String
      },
      interviewRound: {
        type: String
      },
      interviewViaMode: {
        type: String
      },
      meetingType: {
        type: String
      },
      interviewDuration: {
        type: String
      },
      interviewWith: {
        type: String
      },
      jobTitle: {
        type: String
      },
      timeShift: {
        type: String
      },
      timeZone: {
        type: String
      },
      updatedBy: {
        type: String
      },
      remarks: {
        type: String
      },
      specialNote: {
        type: String
      },
    },{
      timestamps: true,
    });
  
  const Interview = mongoose.model('Interview',interviewSchema);
  
  module.exports = Interview;