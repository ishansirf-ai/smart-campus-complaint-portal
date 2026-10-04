// Import Mongoose. It connects Node.js to MongoDB.
const mongoose = require("mongoose");

// This function connects the backend to MongoDB Atlas.
async function connectDatabase() {
  // Read MongoDB string from private .env file.
  const mongoUri = process.env.MONGODB_URI;

  // Stop if the user forgot to add the MongoDB string.
  if (!mongoUri) {
    throw new Error("MONGODB_URI is missing in .env file.");
  }

  // Connect Mongoose to MongoDB.
  const connection = await mongoose.connect(mongoUri);

  // Show successful connection in terminal.
  console.log(`MongoDB connected: ${connection.connection.host}`);
}

// Allow server.js to use this function.
module.exports = connectDatabase;