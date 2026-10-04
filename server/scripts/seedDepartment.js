const path = require("path");

require("dotenv").config({
  path: path.join(__dirname, "../../.env")
});

const mongoose = require("mongoose");

const connectDatabase = require("../config/db");
const User = require("../models/User");

async function createDepartmentUser() {
  try {
    await connectDatabase();

    const email = process.env.DEPARTMENT_EMAIL.toLowerCase();

    const existingUser = await User.findOne({ email });

    if (existingUser) {
      console.log(`Department user already exists: ${email}`);
      return;
    }

    const user = await User.create({
      fullName: "IT Department Staff",
      email,
      password: process.env.DEPARTMENT_PASSWORD,
      department: process.env.DEPARTMENT_NAME,
      role: "department"
    });

    console.log(
      `Department user created successfully: ${user.email}`
    );
  } catch (error) {
    console.error(
      `Could not create department user: ${error.message}`
    );

    process.exitCode = 1;
  } finally {
    await mongoose.connection.close();
  }
}

createDepartmentUser();