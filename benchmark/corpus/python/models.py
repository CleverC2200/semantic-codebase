from dataclasses import dataclass


@dataclass
class Definition:
    qualified_name: str
    start_byte: int
    end_byte: int

    def contains(self, offset: int) -> bool:
        return self.start_byte <= offset < self.end_byte


class DefinitionRegistry:
    def __init__(self) -> None:
        self._definitions: dict[str, Definition] = {}

    def register(self, definition: Definition) -> None:
        self._definitions[definition.qualified_name] = definition

    def resolve(self, qualified_name: str) -> Definition | None:
        return self._definitions.get(qualified_name)
