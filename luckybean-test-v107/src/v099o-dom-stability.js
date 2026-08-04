/* Lucky Bean 099o DOM stability.
 * Older compatibility modules watch childList changes and also rewrite a few
 * static labels during every pass. Replacing an identical text node is still a
 * DOM mutation, so the observer can trigger itself indefinitely. This guard is
 * deliberately narrow: it suppresses only identical writes on known static
 * Lucky Bean labels and leaves every other DOM write untouched.
 */
if (!globalThis.__LuckyBeanV099oDomStabilityLoaded) {
  globalThis.__LuckyBeanV099oDomStabilityLoaded = true;

  const nativeReplaceChildren = Element.prototype.replaceChildren;
  const textContentDescriptor = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent');

  function isStaticLabelNode(node) {
    if (!(node instanceof Element)) return false;
    return node.matches('#titleBrew,.cup-action,#v095ThemeSettingBtn')
      || node.matches('[data-page-target="brew"] > span');
  }

  Element.prototype.replaceChildren = function stableReplaceChildren(...nodes) {
    if (isStaticLabelNode(this) && nodes.length === 1) {
      const next = nodes[0] instanceof Node ? nodes[0].textContent : String(nodes[0] ?? '');
      if (this.childNodes.length === 1 && this.textContent === next) return;
    }
    return nativeReplaceChildren.apply(this, nodes);
  };

  if (textContentDescriptor?.get && textContentDescriptor?.set) {
    Object.defineProperty(Node.prototype, 'textContent', {
      configurable: textContentDescriptor.configurable,
      enumerable: textContentDescriptor.enumerable,
      get: textContentDescriptor.get,
      set(value) {
        const next = value == null ? '' : String(value);
        if (isStaticLabelNode(this) && textContentDescriptor.get.call(this) === next) return;
        textContentDescriptor.set.call(this, value);
      }
    });
  }
}
