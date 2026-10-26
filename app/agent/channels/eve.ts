// Repro only: the driver binds the server to 127.0.0.1 and calls it without credentials,
// which `eve start` otherwise refuses. Do not copy into a real app.
import { eveChannel } from "eve/channels/eve";
import { none } from "eve/channels/auth";

export default eveChannel({ auth: [none()] });
