# abomess
A MCP MMS Router implementation.

# Installation

1. Install [Node](https://nodejs.org/en/). This also install `npm`.
2. Create a directory for this software, for example `mkdir testMMS`, and change into it: `cd testMMS`
3. Install this MMS Router: `npm install https://github.com/aboamare/abomess.git`
4. Start the router with: `npm start`. Now not much will happen until some agent connects to the router.... The router should be available at `ws://localhost:3001/router`

# Agent
To play with this prototype MMS Router you need an agent. At minimum this can be a simple web socket client for which you create hand crafted messages (in JOSN format) according to the draft specification. One option is to use a [Chrome Extension](https://chrome.google.com/webstore/detail/websocket-test-client/fgponpodhbmadfljofbimhhlengambbn). Another nice option is to use a recent version of [Postman](https://blog.postman.com/postman-supports-websocket-apis/).

# Notes
- the current implementation does not do any real authentication. When the router sends an `authentication` message with a `nonce`, the agent can send an `authentication` message with a `payload` that contains the `nonce` object, like this:  
    ```
    {"authentication": {
      "payload": {
        "nonce": "jr8eby3t2nazvk0j"
      }
    }}
    ```

- this MMS Router is based upon the upcoming version "2" of the Maritme Identity Registry specification, so it may be picky about MRNs. For example registration of a vessel based agent could look like this:  
    ```
    {"register": {
      "mrn": "urn:mrn:mcp:id:aboamare:spirit",
      "interests": ["urn:mrn:mcp:navigational-warnings-fi", "urn:mrn:mcp:gossip"]
    }}
    ```
