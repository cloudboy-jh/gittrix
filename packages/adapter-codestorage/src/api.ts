import { AdapterUnavailableError } from '../../core/dist/index.js'

export class CodeStorageApiError extends AdapterUnavailableError {
  public constructor(message = 'Code Storage adapter pending early access') {
    super(message)
  }
}

export class CodeStorageClient {
  public constructor() {
    throw new CodeStorageApiError()
  }
}
