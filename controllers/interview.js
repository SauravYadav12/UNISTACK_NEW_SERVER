const Interview = require("../models/interview")

exports.getAllInterviews = async (req, res) => {
    try {
        const interviews = await Interview.find()
        res.status(200).json({
            status: "success",
            data: interviews
        })
    } catch (error) {
        res.status(400).json({
            status: "failed"
        })
    }
}

exports.createInterview = async (req, res) => {
    try {
        const interview = await Interview.create(req.body)
        // console.log("Body", req.body)
        res.status(200).json({
            status: "success",
            data: interview
        })
    } catch (error) {
        console.log(error)
        res.status(400).json({
            status: "failed"
        })
    }
}