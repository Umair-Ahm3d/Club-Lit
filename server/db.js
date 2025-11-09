const mongoose = require("mongoose");

const defaultUri = "mongodb://127.0.0.1:27017/clubreader";
const mongoUri = process.env.DB || defaultUri;

module.exports = async () => {
	try {
		await mongoose.connect(mongoUri);
		const { host, port, name } = mongoose.connection;
		console.log(`Connected to MongoDB: ${host}:${port}/${name}`);
	} catch (error) {
		console.error("Could not connect database!", error);
	}
};
