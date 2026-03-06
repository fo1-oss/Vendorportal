require("dotenv").config();
const app = require("./index.js");
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`CDC Vendor Portal running at http://localhost:${PORT}`);
});
