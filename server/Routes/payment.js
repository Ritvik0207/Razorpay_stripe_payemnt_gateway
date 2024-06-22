const dotenv = require("dotenv");
dotenv.config();
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
	user: 'payment_user',
	host: 'localhost',
	database: 'payment',
	password: '12345',
	port: '5432',

});

// Razorpay payment order creation endpoint
router.post("/orders", async (req, res) => {
	try {
		const instance = new Razorpay({
			key_id:'rzp_test_DL8XNF5TE9MW4P',
			key_secret:'kcWRB5oZ98HrE3eKR7Thc2ef',
		});

		const options = {
			amount: req.body.amount * 100, // amount in paise
			currency: "INR",
			receipt: crypto.randomBytes(10).toString("hex"),
			notes: { userId: req.body.userId }
		};

		instance.orders.create(options, (error, order) => {
			if (error) {
				console.error("Order creation error:", error);
				return res.status(500).json({ message: "Something Went Wrong!" });
			}
			console.log("Order created:", order);
			res.status(200).json({ data: order });
		});
	} catch (error) {
		console.error("Internal Server Error:", error);
		res.status(500).json({ message: "Internal Server Error!" });
	}
});

// Razorpay payment verification endpoint
router.post("/verify", async (req, res) => {
	try {
		const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
		const sign = razorpay_order_id + "|" + razorpay_payment_id;
		const expectedSign = crypto.createHmac("sha256","kcWRB5oZ98HrE3eKR7Thc2ef")
			.update(sign.toString())
			.digest("hex");

		console.log("Expected signature:", expectedSign);
		console.log("Provided signature:", razorpay_signature);

		if (razorpay_signature === expectedSign) {
			const instance = new Razorpay({
				key_id:'rzp_test_DL8XNF5TE9MW4P',
				key_secret:'kcWRB5oZ98HrE3eKR7Thc2ef',
			});

			const order = await instance.orders.fetch(razorpay_order_id);
			console.log("Fetched order:", order);

			if (!order) {
				return res.status(400).json({ message: "Order not found!" });
			}

			const userId = order.notes.userId;
			console.log("Payment verified for user:", userId);
			return res.status(200).json({ message: "Payment verified successfully" });
		} else {
			return res.status(400).json({ message: "Invalid signature sent!" });
		}
	} catch (error) {
		console.error("Verification error:", error);
		res.status(500).json({ message: "Internal Server Error!" });
	}
});

// Stripe payment creation endpoint
router.post("/create-checkout-session", async (req, res) => {
	const { name, amount, userId } = req.body;
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
						unit_amount: amount * 100, // amount in paise
					},
					quantity: 1,
				},
			],
			mode: "payment",
			success_url: "http://51.20.37.103:9000", //mention the your success url here
			cancel_url: "http://51.20.37.103:9000",
			metadata: {
				userId: userId,
			}
		});
		res.json({ id: session.id });
	} catch (error) {
		console.error("Stripe session creation error:", error);
		res.status(500).json({ message: "Internal Server Error!" });
	}
});

// Stripe webhook
router.post("/webhook", express.json({ type: "application/json" }), async (req, res) => {
	let data;
	let eventType;
	let webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

	if (webhookSecret) {
		let event;
		let signature = req.headers["stripe-signature"];

		try {
			event = stripe.webhooks.constructEvent(req.body, signature, webhookSecret);
		} catch (err) {
			console.error("Webhook signature verification failed:", err);
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
			});
			console.log("Webhook data inserted successfully");
		} catch (err) {
			console.error("Error inserting webhook data", err);
		}
	}

	res.status(200).end();
});

// Razorpay webhook
router.post("/razorpay/webhook", express.json({ type: "application/json" }), async (req, res) => {
	const secret = "Ashish";
	const shasum = crypto.createHmac('sha256', secret);
	shasum.update(JSON.stringify(req.body));
	const digest = shasum.digest('hex');

	if (digest === req.headers['x-razorpay-signature']) {
		console.log('Request is legit');
		const eventType = req.body.event;

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
				});
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
