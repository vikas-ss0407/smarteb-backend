const express = require('express');
const cors = require('cors');

const configureMiddleware = (app) => {
  const allowedOrigins = [
    "https://smartebfrontend.onrender.com", // deployed frontend
    "http://localhost:5173"                 // local frontend (adjust port if needed)
  ];

  app.use(cors({
    origin: function(origin, callback) {
      // allow requests with no origin (like Postman) or if origin is in allowedOrigins
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true
  }));

  app.use(express.json());
};

module.exports = configureMiddleware;
