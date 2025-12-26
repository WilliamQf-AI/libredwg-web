import { dwgCodePageToEncoding } from "../database/index.js";
export const decodeString = (array, codepage) => {
    const encoding = dwgCodePageToEncoding(codepage);
    const decoder = new TextDecoder(encoding);
    return decoder.decode(array);
};
//# sourceMappingURL=stringConverter.js.map