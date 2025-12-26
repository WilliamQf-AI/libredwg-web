import { dwgCodePageToEncoding } from "../database";
export const decodeString = (array, codepage) => {
    const encoding = dwgCodePageToEncoding(codepage);
    const decoder = new TextDecoder(encoding);
    return decoder.decode(array);
};
//# sourceMappingURL=stringConverter.js.map