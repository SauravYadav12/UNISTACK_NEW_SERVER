const Requirement = require("../models/requirement");
const { updateArrayFields } = require("../utils/arrayUpdateOprations");
const { paginationInstance } = require("../utils/pagination");
const { sequenceId } = require("../utils/utils");

exports.getAllRrequirements = async (req, res) => {
  try {
    const { options, instance } = await paginationInstance(
      req.query,
      Requirement
    );
    const { startIndex, query, limit } = options;
    const requirements = await Requirement.find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .skip(startIndex)
      .exec();
    const data = { ...instance, results: requirements };
    res.status(200).json({
      status: "success",
      data: data,
    });
  } catch (error) {
    res.status(400).json({
      status: "failed",
    });
  }
};

exports.createRequirement = async (req, res) => {
  try {
    req.body.reqID = await sequenceId(Requirement, "reqID", "REQ");
    const requirement = await Requirement.create(req.body);
    res.status(200).json({
      status: "success",
      data: requirement,
    });
  } catch (error) {
    console.log(error);
    res.status(400).json({
      status: "failed",
    });
  }
};

exports.updateRequirement = async (req, res) => {
  try {
    const arrayFields = ["mComment"];

    const updateOps = updateArrayFields(req, arrayFields);

    const nonArrayUpdates = { ...req.body };

    const updatedReq = await Requirement.findByIdAndUpdate(
      req.params.id,
      { ...nonArrayUpdates, ...updateOps },
      { new: true }
    );

    res.status(200).json({
      status: "success",
      data: updatedReq,
    });
  } catch (error) {
    res.status(400).json({
      status: "failed",
      error,
    });
  }
};

exports.deleteRequirement = async (req, res) => {
  try {
    const { id } = req.params;
    const deletedRequirement = await Requirement.findByIdAndDelete(id);

    if (!deletedRequirement) {
      return res.status(404).json({
        status: "failed",
        message: "Requirement not found",
      });
    }

    res.status(200).json({
      status: "success",
      message: "Requirement deleted successfully",
      deletedRequirement,
    });
  } catch (error) {
    res.status(500).json({
      status: "failed",
      error: error.message,
    });
  }
};
