import Parser from 'tree-sitter';
import Python from 'tree-sitter-python';

// Parse declarations only; never import or execute the indexed Python module.
export function pythonCallableSignature(source) {
  const parser = new Parser();
  parser.setLanguage(Python);
  const tree = parser.parse(source, undefined, { bufferSize: Math.max(32768, Buffer.byteLength(source, 'utf8') + 1) });
    let fn = tree.rootNode.namedChildren[0];
    if (fn?.type === 'decorated_definition') fn = fn.childForFieldName('definition');
    if (fn?.type !== 'function_definition') return null;
    const parameters = fn.childForFieldName('parameters');
    if (!parameters || parameters.hasError) return null;
    const inputs = parameters.namedChildren.filter(p => !['keyword_separator', 'positional_separator'].includes(p.type)).map(p => {
      const name = p.childForFieldName('name') ?? p.namedChildren.find(n => ['identifier', 'list_splat_pattern', 'dictionary_splat_pattern'].includes(n.type));
      return { name: p.type === 'identifier' || p.type.endsWith('splat_pattern') ? p.text : name?.text ?? p.text,
        optional: Boolean(p.childForFieldName('value')), type: p.childForFieldName('type')?.text ?? null };
    });
    return { inputs, output: fn.childForFieldName('return_type')?.text ?? null,
      raw: source.slice(0, fn.childForFieldName('body').startIndex), basis: 'source_annotation', verified: false };
}
