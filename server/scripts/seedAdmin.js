const path = require("path");

// Load root .env file.
require("dotenv").config({
  path: path.join(__dirname, "../../.env")
});

const mongoose = require("mongoose");
const connectDatabase = require("../config/db");
const User = require("../models/User");

async function createAdmin() {
  try {
    // Check required data exists in .env.
    if (
      !process.env.ADMIN_EMAIL ||
      !process.env.ADMIN_PASSWORD
    ) {
      throw new Error(
        "Set ADMIN_EMAIL and ADMIN_PASSWORD in .env first."
      );
    }

    await connectDatabase();

    const email = process.env.ADMIN_EMAIL.toLowerCase();

    // Check if admin already exists.
    const existingAdmin = await User.findOne({ email });

    if (existingAdmin) {
  existingAdmin.password = process.env.ADMIN_PASSWORD;
  existingAdmin.fullName =
    process.env.ADMIN_NAME || "Portal Administrator";
  existingAdmin.role = "admin";
  existingAdmin.department = "Administration";
  existingAdmin.isActive = true;

  await existingAdmin.save();

  console.log(`Admin password reset successfully: ${email}`);
  return;
}

    // Create first admin.
    const admin = await User.create({
      fullName: process.env.ADMIN_NAME || "Portal Administrator",
      email,
      password: process.env.ADMIN_PASSWORD,
      department: "Administration",
      role: "admin"
    });

    console.log(`Admin created successfully: ${admin.email}`);
  } catch (error) {
    console.error(`Could not create admin: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await mongoose.connection.close();
  }
}

createAdmin();