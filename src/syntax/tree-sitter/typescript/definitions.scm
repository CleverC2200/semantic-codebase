(internal_module
  name: (identifier) @module.name) @module.definition

(class_declaration
  name: (type_identifier) @class.name) @class.definition

(interface_declaration
  name: (type_identifier) @interface.name) @interface.definition

(function_declaration
  name: (identifier) @function.name) @function.definition

(method_definition
  name: [(property_identifier) (private_property_identifier)] @method.name) @method.definition

(variable_declarator
  name: (identifier) @function.name
  value: [(arrow_function) (function_expression)]) @function.definition

(public_field_definition
  name: [(property_identifier) (private_property_identifier)] @method.name
  value: [(arrow_function) (function_expression)]) @method.definition
