const Teams = require("../models/teams");

exports.getAllTeams = async (req, res) => {
  try {
    const teams = await Teams.find().sort({ createdAt: -1 });
    res.status(200).json({
      status: "success",
      data: teams,
    });
  } catch (error) {
    res.status(400).json({
      status: "failed",
    });
  }
};

exports.createTeam = async (req, res) => {
  try {
    const lastTeam = await Teams.findOne().sort({ teamId: -1 });
    const newTeamId = lastTeam ? lastTeam.teamId + 1 : 1;
    req.body.teamId = newTeamId;
    const team = await Teams.create(req.body);
    console.log("Body", req.body);
    res.status(200).json({
      status: "success",
      data: team,
    });
  } catch (error) {
    console.log(error);
    res.status(400).json({
      status: "failed",
    });
  }
};

exports.updateTeam = async (req, res) => {
  try {
    const id = req.params.id;
    const data = await Teams.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
    });
    if (!data) {
      return res.status(404).json({
        status: "failed",
        message: "Team not found",
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

exports.deleteTeam = async (req, res) => {
  try {
    const id = req.params.id;
    const deleteTeam = await Teams.findByIdAndDelete(id);
    if (!deleteTeam) {
      return res.status(404).json({
        status: "failed",
        message: "Team not found",
      });
    }
    res.status(200).json({
      status: "success",
      message: "Team deleted successfully",
      deleteTeam,
    });
  } catch (error) {
    res.status(500).json({
      status: "failed",
      error: error.message,
    });
  }
};
