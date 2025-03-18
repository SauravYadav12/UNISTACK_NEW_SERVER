const Vendor = require("../models/vendor");
const { paginationInstance } = require("../utils/pagination");
const { sequenceId } = require("../utils/utils");
exports.getAllInterviews = async (req, res) => {
  try {
    const { options, instance } = await paginationInstance(req.query, Vendor);
    const { startIndex, query, limit } = options;
    const interviews = await Vendor.find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .skip(startIndex)
      .exec();
    const data = { ...instance, results: interviews };
    res.status(200).json({
      status: "success",
      data,
    });
  } catch (error) {
    res.status(400).json({
      status: "failed",
    });
  }
};

exports.createInterview = async (req, res) => {
  try {
    req.body.testID = await sequenceId(Vendor,'testID', "TEST");
    const interview = await Vendor.create(req.body);
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
    const data = await Vendor.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
    });
    if (!data) {
      return res.status(404).json({
        status: "failed",
        message: "Vendor Interview not found",
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
    const deleteInterview = await Vendor.findByIdAndDelete(id);
    if (!deleteInterview) {
      return res.status(404).json({
        status: "failed",
        message: "Vendor Interview not found",
      });
    }
    res.status(200).json({
      status: "success",
      message: "Vendor Interview deleted successfully",
      deleteInterview,
    });
  } catch (error) {
    res.status(500).json({
      status: "failed",
      error: error.message,
    });
  }
};
