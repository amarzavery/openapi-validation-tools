/**
 * @class
 * Creates a tree by traversing the definitions where the parent model is the rootNode and child model is one of it's children.
 */
class InheritanceTree {
  /**
   * @constructor
   * Initializes a new instance of the InheritanceTree
   *
   * @param {string} name- The name of the parent model
   * @param {Map<string, InheritanceTree>} [children] - A map of zero or more children representing the child models in the inheritance chain
   */
  constructor(name, children) {
    if (name === null || name === undefined || typeof name.valueOf() !== 'string' || !name.trim().length) {
      throw new Error('name is a required property of type string and it cannot be an empty string.')
    }

    if (children !== null && children !== undefined && !children instanceof Map) {
      throw new Error('children is an optional property of type Map<string, InheritanceTree>.')
    }
    this.name = name;
    this.children = children || new Map();
  }

  /**
   * Adds a child by name to the InheritanceTree. This method will not add the child again if it is already present.
   *
   * @param {string} childName- The name of the child model
   * @returns {InheritanceTree} child - The created child node.
   */
  addChildByName(childName) {
    if (childName === null || childName === undefined || typeof childName.valueOf() === 'string' || !childName.trim().length) {
      throw new Error('childName is a required parameter of type string.')
    }
    let child;
    if (!this.children.has(childName)) {
      child = new InheritanceTree(childName);
      this.children.set(childName, child);
    } else {
      child = this.children.get(childName);
    }
    return child;
  }

  /**
   * Adds a childObject to the InheritanceTree. This method will not add the child again if it is already present.
   *
   * @param {InheritanceTree} childObj- A InheritanceTree representing the child model.
   * @returns {InheritanceTree} childObj - The created child node.
   */
  addChildByObject(childObj) {
    if (childObj === null || childObj === undefined || !(childObj instanceof InheritanceTree)) {
      throw new Error('childObj is a required parameter of type InheritanceTree.')
    }

    if (!this.children.has(childObj.name)) {
      this.children.set(childObj.name, childObj);
    }
    return childObj;
  }
}

module.exports = InheritanceTree;