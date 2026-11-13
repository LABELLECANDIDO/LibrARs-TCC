from pydantic import BaseModel, field_validator

VECTOR_DIM = 63


class GestureCreate(BaseModel):
    id: str | None = None
    name: str
    samples: list[list[float]]

    @field_validator("samples")
    @classmethod
    def validate_samples(cls, v: list[list[float]]) -> list[list[float]]:
        if not v:
            raise ValueError("samples não pode ser vazio")
        for i, s in enumerate(v):
            if len(s) != VECTOR_DIM:
                raise ValueError(
                    f"sample[{i}] deve ter {VECTOR_DIM} dimensões, recebeu {len(s)}"
                )
        return v


class GestureOut(BaseModel):
    id: str
    name: str
    samples: list[list[float]]
    sample_count: int
    created_at: str
    updated_at: str


class ClassifyRequest(BaseModel):
    vector: list[float]
    gestures: list[dict]

    @field_validator("vector")
    @classmethod
    def validate_vector(cls, v: list[float]) -> list[float]:
        if len(v) != VECTOR_DIM:
            raise ValueError(f"vector deve ter {VECTOR_DIM} dimensões, recebeu {len(v)}")
        return v


class CompressRequest(BaseModel):
    samples: list[list[float]]


class RecordingCreate(BaseModel):
    """Item 1 — uma gravação (repetição) de um gesto."""
    frames: list[list[float]]              # quadros brutos: 63 valores da mão por quadro
    body: list | None = None               # por quadro: pontos da pose + features (item 2); null se sem pose
    hand_ratio: float = 0.0                # fração de quadros com mão detectada
    pose_ratio: float = 0.0                # fração de quadros com rosto+ombros detectados
    source: str = "manual"                 # 'manual' | 'segmentado'
    app_version: str | None = None
