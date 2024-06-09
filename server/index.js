const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const paymentRoutes = require("./Routes/payment");
const { sequelize } = require('./model');
const app = express();

dotenv.config();
app.use(cors());
app.use(express.json());
app.use("/api/payment/", paymentRoutes);

const port = process.env.PORT || 9000;

sequelize.sync().then(() => {
    app.listen(port, () => console.log(`Listening on port ${port}...`));
}).catch(err => {
    console.error('Unable to connect to the database:', err);
});
