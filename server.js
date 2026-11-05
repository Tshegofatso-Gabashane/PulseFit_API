require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { randomUUID } = require("crypto");
const multer = require("multer");
const { BlobServiceClient } = require("@azure/storage-blob");

const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");
const serviceAccount = require(
    process.env.RENDER
        ? "/etc/secrets/serviceAccountKey.json"
        : "./serviceAccountKey.json"
);

initializeApp({
    credential: cert(serviceAccount)
});

const db = getFirestore();
const blobServiceClient = BlobServiceClient.fromConnectionString(
    process.env.AZURE_STORAGE_CONNECTION_STRING
);

const containerClient = blobServiceClient.getContainerClient(
    process.env.AZURE_STORAGE_CONTAINER
);

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 5 * 1024 * 1024
    },
    fileFilter: (req, file, cb) => {
        const allowedTypes = [
            "image/jpeg",
            "image/png",
            "image/webp"
        ];

        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error("Only JPEG, PNG and WebP images are allowed."));
        }
    }
});

const app = express();

app.use(cors());
app.use(express.json());
const verifyFirebaseToken = async (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({
            error: "Authentication required"
        });
    }

    const token = authHeader.split(" ")[1];

    try {
        req.user = await getAuth().verifyIdToken(token);
        next();
    } catch (error) {
        return res.status(401).json({
            error: "Invalid or expired authentication token"
        });
    }
};

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
// Upload an image to Azure Blob Storage
// Upload an image to Azure Blob Storage
app.post("/api/uploads/image", verifyFirebaseToken, upload.single("image"), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                error: "Please select an image."
            });
        }

        const extensions = {
            "image/jpeg": ".jpg",
            "image/png": ".png",
            "image/webp": ".webp"
        };

        const blobName =
            `${req.user.uid}/${randomUUID()}${extensions[req.file.mimetype]}`;

        const blockBlobClient =
            containerClient.getBlockBlobClient(blobName);

        await blockBlobClient.uploadData(req.file.buffer, {
            blobHTTPHeaders: {
                blobContentType: req.file.mimetype
            }
        });

        // Save upload information
        const document = await db.collection("uploads").add({
            userId: req.user.uid,
            blobName: blobName,
            contentType: req.file.mimetype,
            createdAt: new Date().toISOString()
        });

        // Save the image reference in the user's profile
        await db.collection("users").doc(req.user.uid).set({
            profileImageBlobName: blobName,
            profileImageContentType: req.file.mimetype,
            profileImageUpdatedAt: new Date().toISOString()
        }, { merge: true });

        res.status(201).json({
            message: "Image uploaded successfully",
            uploadId: document.id,
            blobName: blobName
        });

    } catch (error) {
        console.error("Image upload error:", error);

        res.status(500).json({
            error: "Unable to upload image."
        });
    }
});

// Retrieve the user's profile image from Azure Blob Storage
app.get("/api/profile/image", verifyFirebaseToken, async (req, res) => {
    try {
        const userDoc = await db.collection("users").doc(req.user.uid).get();

        if (!userDoc.exists || !userDoc.get("profileImageBlobName")) {
            return res.status(404).json({
                error: "Profile image not found."
            });
        }

        const blobName = userDoc.get("profileImageBlobName");
        const contentType = userDoc.get("profileImageContentType") || "image/jpeg";

        const blobClient = containerClient.getBlobClient(blobName);
        const downloadResponse = await blobClient.download();

        if (!downloadResponse.readableStreamBody) {
            return res.status(500).json({
                error: "Unable to retrieve profile image."
            });
        }

        res.setHeader("Content-Type", contentType);
        res.setHeader("Cache-Control", "private, max-age=300");

        downloadResponse.readableStreamBody.pipe(res);

    } catch (error) {
        console.error("Profile image retrieval error:", error);

        res.status(500).json({
            error: "Unable to retrieve profile image."
        });
    }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
    console.log(`PulseFit API running on port ${PORT}`);
});