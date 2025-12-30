const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

// SIGNUP CONTROLLER
exports.signup = async (req, res) => {
  try {
    const { name, fatherName, dob, email, password, address, phoneNo, role } = req.body; // Include phoneNo

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: 'User already exists with this email' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create new user
    const newUser = new User({
      name,
      fatherName,
      dob,
      email,
      password: hashedPassword,
      address,
      phoneNo, // Save phoneNo
      role
    });

    await newUser.save();
    res.status(201).json({ message: 'User registered successfully' });

  } catch (error) {
    console.error('Signup Error:', error);
    res.status(500).json({ message: 'Server error during signup' });
  }
};

// LOGIN CONTROLLER
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Find user by email
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ message: 'Invalid email or password' });

    // Compare password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ message: 'Invalid email or password' });

    const secret = process.env.JWT_SECRET;
    const expiresIn = process.env.JWT_EXPIRES_IN || '1d';
    if (!secret) {
      return res.status(500).json({ message: 'Server misconfigured: missing JWT secret' });
    }

    const token = jwt.sign(
      { sub: user._id, role: user.role, email: user.email },
      secret,
      { expiresIn }
    );

    // Return user role, token, and basic info
    res.status(200).json({
      message: 'Login successful',
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role // role inside 'user' object
      }
    });

  } catch (error) {
    console.error('Login Error:', error);
    res.status(500).json({ message: 'Server error during login' });
  }
};



exports.getUserById = async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    // Return only the required fields
    res.json({
      name: user.name,
      address: user.address,
      email: user.email,
      phoneNo: user.phoneNo || '', // Return phoneNo if it exists
    });
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({ message: 'Server error' });
  }
};