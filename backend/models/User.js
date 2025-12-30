const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: String,
  fatherName: String,
  dob: String,
  email: { type: String, unique: true },
  password: String,
  address: String,
  phoneNo: String, // Add phoneNo field
  role: String
});

module.exports = mongoose.model('User', userSchema);
