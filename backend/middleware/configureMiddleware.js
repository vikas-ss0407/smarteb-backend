const express = require('express');
const cors = require('cors');

const configureMiddleware = (app) => {
  app.use(cors({
    origin: "*",
    credentials: true
  }));
  app.use(express.json());
};

module.exports = configureMiddleware;
