const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../../.env") });

const mongoose = require("mongoose");
const connectDatabase = require("../config/db");
const User = require("../models/User");
const { DEPARTMENT_CODES } = require("../config/portal");

async function seedDepartments() {
  try {
    const missing = DEPARTMENT_CODES.flatMap((code) => {
      return process.env[`${code}_EMAIL`] && process.env[`${code}_PASSWORD`]
        ? []
        : [`${code}_EMAIL and ${code}_PASSWORD`];
    });
    if (missing.length) {
      throw new Error(`Missing .env values: ${missing.join(", ")}`);
    }

    await connectDatabase();
    for (const code of DEPARTMENT_CODES) {
      const email = process.env[`${code}_EMAIL`].trim().toLowerCase();
      const password = process.env[`${code}_PASSWORD`];
      const user = await User.findOne({ email }).select("+password");
      if (user) {
        user.fullName = `${code} Department Staff`;
        user.password = password;
        user.department = code;
        user.role = "department";
        user.isActive = true;
        await user.save();
        console.log(`Department account updated: ${code} (${email})`);
      } else {
        await User.create({
          fullName: `${code} Department Staff`,
          email,
          password,
          department: code,
          role: "department"
        });
        console.log(`Department account created: ${code} (${email})`);
      }
    }
  } catch (error) {
    console.error(`Could not seed department accounts: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await mongoose.connection.close();
  }
}

seedDepartments();
