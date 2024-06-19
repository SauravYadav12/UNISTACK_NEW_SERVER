const JwtStrategy = require('passport-jwt').Strategy;
const ExtractJwt = require('passport-jwt').ExtractJwt;
const User = require('../models/user');
const dotenv = require('dotenv');

dotenv.config({ path: './config.env' });

module.exports = function(passport){
    let options = {};
    
    options.jwtFromRequest = ExtractJwt.fromAuthHeaderWithScheme("JWT");
    options.secretOrKey = process.env.JWT_SECRET_KEY;

    passport.use(new JwtStrategy(options, (jwt_payload, done) =>{
        
        // console.log(jwt_payload);

        User.getUserById(jwt_payload.user._id, (err,user)=>{
            if(err){
                return done(err,false);
            }

            if(user){
                return done(null,user);
            }
            else{
                return done(null,false);
            }
        });
    }));
}