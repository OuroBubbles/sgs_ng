import ts from 'typescript';

export function walk(node, visit) {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}
export function literal(node) {
  return node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    ? node.text
    : null;
}
export function fields(node) {
  return new Map(
    node.properties
      .filter(ts.isPropertyAssignment)
      .map((property) => [
        property.name.getText().replace(/^['"]|['"]$/g, ''),
        property.initializer,
      ]),
  );
}
export function at(file, source, node) {
  return { file, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1 };
}

/** 仅解析项目自有标准目录；引用审阅与行为审阅共用，普通检查不读取参考项目。 */
export function collectStandardCatalogue(read, names) {
  function parse(file) {
    return ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true);
  }
  const skills = new Map();
  const cards = new Map();
  const generals = [];
  const definitions = new Map();
  for (const file of names) {
    const path = `src/content/standard/${file}`;
    const source = parse(path);
    walk(source, (node) => {
      // 这里只识别本目录明确使用的坐骑工厂调用，不解释任意作者函数。
      if (
        file === 'equipment.ts' &&
        ts.isCallExpression(node) &&
        node.expression.getText(source) === 'horse'
      ) {
        const id = literal(node.arguments[0]);
        const name = literal(node.arguments[1]);
        if (!id || !name) throw new Error('Horse inventory requires literal IDs and labels.');
        definitions.set(`standard:${id}`, { name, source: at(path, source, node) });
      }
      if (!ts.isObjectLiteralExpression(node)) return;
      const values = fields(node);
      const id = literal(values.get('id'));
      if (id?.startsWith('standard:')) {
        const name = literal(values.get('name'));
        const description = literal(values.get('description'));
        if (name && description)
          skills.set(id, { id, name, description, source: at(path, source, node) });
        const label = literal(values.get('label'));
        if (label) definitions.set(id, { name: label, source: at(path, source, node) });
        const list = values.get('skills');
        if (name && list && ts.isArrayLiteralExpression(list)) {
          const ids = list.elements.map((entry) => {
            if (literal(entry) !== null) return literal(entry);
            if (
              ts.isPropertyAccessExpression(entry) &&
              entry.name.text === 'id' &&
              ts.isIdentifier(entry.expression)
            )
              return `standard:${entry.expression.text}`;
            throw new Error(`Unsupported general skill expression: ${entry.getText(source)}`);
          });
          generals.push({ id, name, skills: ids, source: at(path, source, node) });
        }
      }
      for (const property of node.properties) {
        if (!ts.isPropertyAssignment(property)) continue;
        const id = literal(property.name);
        if (!id?.startsWith('standard:') || !ts.isObjectLiteralExpression(property.initializer))
          continue;
        const view = fields(property.initializer);
        const description = literal(view.get('description'));
        if (description) cards.set(id, { id, description, source: at(path, source, property) });
      }
    });
  }
  if (generals.length !== 25 || skills.size !== 40 || cards.size !== 32)
    throw new Error('Standard source inventory changed; review the audit baseline.');
  for (const general of generals)
    for (const id of general.skills)
      if (!skills.has(id)) throw new Error(`Unknown general skill: ${id}`);

  return { skills, cards, generals, definitions };
}
