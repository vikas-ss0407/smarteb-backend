// middleware/configureMiddleware.js
const express = require('express');
const cors = require('cors');

const configureMiddleware = (app) => {
  app.use(cors());
  app.use(express.json());
};

module.exports = configureMiddleware;
