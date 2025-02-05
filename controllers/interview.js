const Interview = require("../models/interview")

exports.getAllInterviews = async (req, res) => {
    try {
      const { intId, interviewStatus,fromDate, toDate, marketingPersonRef,marketingPerson  } =
      req.query;

    const customQuery = {};

    if (intId) customQuery.intId = intId;
    if (interviewStatus) customQuery.interviewStatus = interviewStatus;
    if (fromDate || toDate) {
      const parsedStartDate = Date.parse(fromDate) || new Date();
      const parsedEndDate = Date.parse(toDate) || new Date();
      customQuery.createdAt = {
        $gte: parsedStartDate,
        $lte: parsedEndDate,
      };
    }
    if (marketingPersonRef) customQuery.marketingPersonRef = marketingPersonRef;
    if (marketingPerson) customQuery.marketingPerson = marketingPerson;

        const interviews = await Interview.find(customQuery)
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

exports.updateInterview = async (req, res) => {
    try {
      const id = req.params.id;
      console.log("Incoming UPDATE request ID:", id);
      const data = await Interview.findByIdAndUpdate(req.params.id, req.body, {new: true});
    //   console.log(req.params.id)
      if (!data) {
        return res.status(404).json({
          status: "failed",
          message: "Interview not found",
        });
      }
      res.status(200).json({
        status: "success",
        data: data
      })
    } catch (error) {
      res.status(400).json({
        status: "failed",
        error
      })
    }
  }

  exports.deleteInterview = async (req, res) => {
    try {
        const id = req.params.id;
        const deleteInterview = await Interview.findByIdAndDelete(id);
        if (!deleteInterview) {
          return res.status(404).json({
            status: "failed", 
            message: "Interview not found" 
        });
        }
        res.status(200).json({
            status: "success",
             message: "Interview deleted successfully",
             deleteInterview
            });
      } catch (error) {
        res.status(500).json({ 
            status: "failed",
            error: error.message, 
        });
      }
  }