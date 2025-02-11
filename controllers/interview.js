const Interview = require("../models/interview");
const { myDate } = require("../utils/dateUtil");

exports.getAllInterviews = async (req, res) => {
  try {
    const { fromDate, toDate } = req.query;

    if (fromDate || toDate) {
      const { from, to } = myDate(fromDate, toDate);
      req.query.createdAt = {
        $gte: from,
        $lte: to,
      };
      delete req.query.fromDate;
      delete req.query.toDate;
    }

    const interviews = await Interview.find(req.query).sort({ createdAt: -1 });
    res.status(200).json({
      status: "success",
      data: interviews,
    });
  } catch (error) {
    res.status(400).json({
      status: "failed",
    });
  }
};

exports.createInterview = async (req, res) => {
  try {
    const interview = await Interview.create(req.body);
    res.status(200).json({
      status: "success",
      data: interview,
    });
  } catch (error) {
    console.log(error);
    res.status(400).json({
      status: "failed",
    });
  }
};

exports.updateInterview = async (req, res) => {
  try {
    const id = req.params.id;
    console.log("Incoming UPDATE request ID:", id);
    const data = await Interview.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
    });
    if (!data) {
      return res.status(404).json({
        status: "failed",
        message: "Interview not found",
      });
    }
    res.status(200).json({
      status: "success",
      data: data,
    });
  } catch (error) {
    res.status(400).json({
      status: "failed",
      error,
    });
  }
};

exports.deleteInterview = async (req, res) => {
  try {
    const id = req.params.id;
    const deleteInterview = await Interview.findByIdAndDelete(id);
    if (!deleteInterview) {
      return res.status(404).json({
        status: "failed",
        message: "Interview not found",
      });
    }
    res.status(200).json({
      status: "success",
      message: "Interview deleted successfully",
      deleteInterview,
    });
  } catch (error) {
    res.status(500).json({
      status: "failed",
      error: error.message,
    });
  }
};
