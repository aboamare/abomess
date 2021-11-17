const schemae = {
  MRN: /^urn:mrn:/,
  MCP: /^urn:mrn:mcp:id:/
}

class MRN extends String {
  static validate (str, schema = 'MCP') {
    let valid = schemae[schema].test(str)
    if (valid !== true) {
      throw new URIError(`${str} is not a valid ${schema} mrn.`)
    }
  }

  constructor (str) {
    MRN.validate(str)
    super(str)
  }
}

export default (str) => {return new MRN(str)}