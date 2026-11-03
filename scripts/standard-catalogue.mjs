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

/** 标准目录的 .ts 源文件（含一将一文件的 generals/），相对 src/content/standard、已排序。 */
export function standardSourceNames(readdirSync, directory) {
  return readdirSync(directory, { recursive: true })
    .map((name) => String(name).split('\\').join('/'))
    .filter((name) => name.endsWith('.ts'))
    .sort();
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
    // 同文件内 `const x = skill({ id: '...' })` 或普通对象的变量名，供 general(id, name, kingdom, hp, [x]) 解析。
    const local = new Map();
    walk(source, (node) => {
      if (!ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name) || !node.initializer)
        return;
      let value = node.initializer;
      if (ts.isSatisfiesExpression(value)) value = value.expression;
      if (ts.isCallExpression(value) && value.arguments.length === 1) value = value.arguments[0];
      if (!ts.isObjectLiteralExpression(value)) return;
      const id = literal(fields(value).get('id'));
      if (id) local.set(node.name.text, id);
    });
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
      if (
        ts.isCallExpression(node) &&
        node.expression.getText(source) === 'general' &&
        node.arguments.length >= 5
      ) {
        const id = literal(node.arguments[0]);
        const name = literal(node.arguments[1]);
        const list = node.arguments[4];
        if (!id || !name || !ts.isArrayLiteralExpression(list))
          throw new Error('General requires literal ID, name and skill list.');
        const ids = list.elements.map((entry) => {
          if (literal(entry) !== null) return literal(entry);
          if (ts.isIdentifier(entry) && local.has(entry.text)) return local.get(entry.text);
          throw new Error(`Unsupported general skill expression: ${entry.getText(source)}`);
        });
        generals.push({ id, name, skills: ids, source: at(path, source, node) });
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
