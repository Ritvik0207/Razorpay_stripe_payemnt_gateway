const dotenv = require("dotenv");
dotenv.config()
const router = require("express").Router();
const Razorpay = require("razorpay");
const crypto = require("crypto");
const Stripe = require('stripe');
const express = require("express");
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const { RazorpayWebhookData, StripeWebhookData } = require('../model');
const { Pool } = require('pg');

// Create a PostgreSQL pool
const pool = new Pool({
	user: 'postgres',
	host: 'localhost',
	database: 'payment1',
	password: '123456',
	port: '5432',
});

//this is the endpoint for razorpay payment
router.post("/orders", async (req, res) => {
	try {
		const instance = new Razorpay({
			key_id: process.env.KEY_ID,
			key_secret: process.env.KEY_SECRET,
		});

		const options = {
			amount: req.body.amount * 100,
			currency: "INR",
			receipt: crypto.randomBytes(10).toString("hex"),
			notes: { userId: req.body.userId }  //you also get other fields from frontend and store in the notes which can be retrieved through webhook after completion
		};
		instance.orders.create(options, (error, order) => {
			if (error) {
				console.log(error);
				return res.status(500).json({ message: "Something Went Wrong!" });
			}
			res.status(200).json({ data: order });
		});
	} catch (error) {
		res.status(500).json({ message: "Internal Server Error!" });
		console.log(error);
	}
});


//the below verification part might not be required if your already usinng webhooks beacuse the verification will take place there
router.post("/verify", async (req, res) => {
	try {
		const { razorpay_order_id, razorpay_payment_id, razorpay_signature } =
			req.body;
		const sign = razorpay_order_id + "|" + razorpay_payment_id;
		const expectedSign = crypto
			.createHmac("sha256", process.env.KEY_SECRET)
			.update(sign.toString())
			.digest("hex");

		if (razorpay_signature === expectedSign) {
			// Fetch the order details from Razorpay to get the notes
			const instance = new Razorpay({
				key_id: process.env.KEY_ID,
				key_secret: process.env.KEY_SECRET,
			});

			const order = await instance.orders.fetch(razorpay_order_id);
			const userId = order.notes.userId; // Retrieve userId from notes

			//	console.log("Payment verified for user:", userId);
			return res.status(200).json({ message: "Payment verified successfully" });
		} else {
			return res.status(400).json({ message: "Invalid signature sent!" });
		}
	} catch (error) {
		res.status(500).json({ message: "Internal Server Error!" });
		console.log(error);
	}
});

//this is the enpoint fot stripe payment
router.post("/create-checkout-session", async (req, res) => {
	const { name, amount, userId } = req.body;  //you also get other fields from frontend and store in the metadata which can be retrieved through webhook after completion
	try {
		const session = await stripe.checkout.sessions.create({
			payment_method_types: ["card"],
			line_items: [
				{
					price_data: {
						currency: 'inr',
						product_data: {
							name: name,
						},
						unit_amount: amount * 100,
					},
					quantity: 1,
				},
			],
			mode: "payment",
			success_url: "http://44.211.47.208:3000", //mention the your success url here
			cancel_url: "http://44.211.47.208:3000",//mention the your url here;
			metadata: {
				userId: userId,
			}
		});
		// console.log(session);

		res.json({ id: session.id });
	} catch (error) {
		res.status(500).json({ message: "Internal Server Error!" });
		console.log(error);
	}
});

//stripe webhook
router.post("/webhook", express.json({ type: "application/json" }), async (req, res) => {
	let data;
	let eventType;

	let webhookSecret;
	//webhookSecret=process.env.STRIPE_WEBHOOK_SECRET
	if (webhookSecret) {
		let event;
		let signature = req.headers["stripe-signature"];

		try {
			event = stripe.webhooks.constructEvent(req.body, signature, webhookSecret);
		} catch (err) {
			console.log(`⚠️  Webhook signature verification failed:  ${err}`);
			return res.sendStatus(400);
		}
		data = event.data.object;
		eventType = event.type;
	} else {
		data = req.body.data.object;
		eventType = req.body.type;
	}

	if (eventType === "checkout.session.completed") {
		const { payment_intent, amount_total, currency } = data;
		const userId = data.metadata.userId;
		try {
			await StripeWebhookData.create({
				userId,
				paymentIntent: payment_intent,
				amount: amount_total,
				currency,
			});// you can also add any other details into your db which you recieved from the webhook
			console.log("Webhook data inserted successfully");
		} catch (err) {
			console.error("Error inserting webhook data", err);
		}
	}

	res.status(200).end();
});

// Razorpay Webhook
router.post("/razorpay/webhook", async (req, res) => {
	const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
	const shasum = crypto.createHmac('sha256', secret);
	shasum.update(JSON.stringify(req.body));
	const digest = shasum.digest('hex');

	if (digest === req.headers['x-razorpay-signature']) {
		console.log('Request is legit');
		const eventType = req.body.event;
		//console.log(eventType);
		if (eventType === 'payment.captured') {
			const paymentEntity = req.body.payload.payment.entity;
			const { order_id, id: payment_id, amount, currency, notes } = paymentEntity;
			const { userId } = notes;

			try {
				await RazorpayWebhookData.create({
					userId,
					paymentId: payment_id,
					orderId: order_id,
					amount,
					currency,
					eventType,
				});// you can also add any other details into your db which you recieved from the webhook
				console.log("Razorpay webhook data inserted successfully");
			} catch (err) {
				console.error("Error inserting Razorpay webhook data", err);
				return res.status(500).json({ message: "Internal Server Error!" });
			}
		}

		res.status(200).json({ message: "OK" });
	} else {
		res.status(400).json({ message: "Invalid signature" });
	}
});


module.exports = router;
