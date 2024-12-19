const mongoose = require('mongoose');

const vendorSchema = new mongoose.Schema(
    {
        testID: {
        type: String,
        unique: true,
        default: () => `TEST-${new Date().getTime()}`
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
  
  const Vendor = mongoose.model('Vendor',vendorSchema);
  
  module.exports = Vendor;