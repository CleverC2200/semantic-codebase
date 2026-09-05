from .models import Definition, DefinitionRegistry


class RegistryService(DefinitionRegistry):
    @classmethod
    async def create(cls) -> "RegistryService":
        return cls()

    def add_example(self) -> None:
        definition = Definition("示例.run🙂", 0, 12)
        self.register(definition)

    def find_example(self) -> Definition | None:
        return self.resolve("示例.run🙂")


def build_registry() -> RegistryService:
    registry = RegistryService()
    registry.add_example()
    return registry
