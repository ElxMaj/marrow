// @marrowhq/web is a thin window onto core: browse the brain, see decided vs
// open, batch answer questions. Zero product logic. See PR-11.
export {
  createApiServer,
  getState,
  trace,
  answerQuestion,
  isReadOnly,
  type BrainState,
} from "./api.js";
export { startWebServer, type StartWebServerOptions } from "./server.js";
