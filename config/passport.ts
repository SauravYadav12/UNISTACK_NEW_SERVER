const JwtStrategy = require("passport-jwt").Strategy;
const ExtractJwt = require("passport-jwt").ExtractJwt;
import { getUserById } from "../models/userModel";
import dotenv from "dotenv";

dotenv.config({ path: "./config.env" });

module.exports = function (passport: any) {
  let options: any = {};

  options.jwtFromRequest = ExtractJwt.fromAuthHeaderWithScheme("JWT");
  options.secretOrKey = process.env.JWT_SECRET_KEY;

  passport.use(
    new JwtStrategy(options, (jwt_payload: any, done: any) => {
    //   console.log('jwt_payload---------------------------------------------');

      getUserById(jwt_payload.user._id, (err, user) => {
        if (err) {
          return done(err, false);
        }

        if (user) {
          return done(null, user);
        } else {
          return done(null, false);
        }
      });
    })
  );
};
