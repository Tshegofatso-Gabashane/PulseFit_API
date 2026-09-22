const express = require("express");
const cors = require("cors");

const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

const serviceAccount = require(
    process.env.RENDER
        ? "/etc/secrets/serviceAccountKey.json"
        : "./serviceAccountKey.json"
);

initializeApp({
    credential: cert(serviceAccount)
});

const db = getFirestore();


const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
    res.json({
        message: "PulseFit REST API is running"
    });
});

app.get("/api/exercises", async (req, res) => {
    try {
        const snapshot = await db.collection("exercises").get();

        const exercises = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));

        console.log(`Exercises retrieved: ${exercises.length}`);

        res.json(exercises);

    } catch (error) {
        console.error("Exercise API error:", error);

        res.status(500).json({
            error: "Unable to retrieve exercises"
        });
    }
});

app.get("/api/meals", async (req, res) => {
    try {
        const snapshot = await db.collection("meals").get();

        const meals = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));

        console.log(`Meals retrieved: ${meals.length}`);

        res.json(meals);

    } catch (error) {
        console.error("Meal API error:", error);

        res.status(500).json({
            error: "Unable to retrieve meals"
        });
    }
});

// Add a new meal to Firestore
app.post("/api/meals", async (req, res) => {
    try {
        const { name, calories } = req.body;

        // Validate meal information
        if (!name || calories === undefined) {
            return res.status(400).json({
                error: "Meal name and calories are required"
            });
        }

        const calorieNumber = Number(calories);

        if (isNaN(calorieNumber) || calorieNumber < 0) {
            return res.status(400).json({
                error: "Calories must be a valid number"
            });
        }

        const meal = {
            name: name.trim(),
            calories: calorieNumber
        };

        const document =
            await db.collection("meals").add(meal);

        console.log(`Meal added: ${meal.name}`);

        res.status(201).json({
            id: document.id,
            ...meal
        });

    } catch (error) {
        console.error("Add meal API error:", error);

        res.status(500).json({
            error: "Unable to add meal"
        });
    }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
    console.log(`PulseFit API running on port ${PORT}`);
});