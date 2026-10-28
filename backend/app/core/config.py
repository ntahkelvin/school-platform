from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """App settings, read from the .env file."""

    database_url: str = "postgresql+psycopg://school:school@localhost:5432/school_platform"
    secret_key: str = "change-me"
    access_token_minutes: int = 720

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()
