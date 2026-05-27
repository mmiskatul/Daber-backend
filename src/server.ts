import { config } from "./config";
import { app } from "./app";

app.listen(config.port, () => {
  console.log(`Daber backend listening on port http://localhost:${config.port}`);
});
