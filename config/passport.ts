import {
  Strategy as JwtStrategy,
  ExtractJwt,
  StrategyOptionsWithoutRequest,
} from "passport-jwt";
import { getUserById } from "../models/userModel";
import { PassportStatic } from "passport";
import ENV_VARS from "./env.config";


export default function (passport: PassportStatic) {
  const options: StrategyOptionsWithoutRequest = {
    jwtFromRequest: ExtractJwt.fromAuthHeaderWithScheme("JWT"),
    secretOrKey: ENV_VARS.JWT_SECRET_KEY || "your_jwt_secret_key",
  };


  passport.use(
    new JwtStrategy(options, (jwt_payload, done) => {
      if (!jwt_payload?.user?._id) {
        return done(new Error("Invalid token payload"), false);
      }

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
    }),
  );
}
