"""012 — language on social_posts & discovery_results; llm_description on discovery_results"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.engine.reflection import Inspector


def _col_exists(table: str, col: str) -> bool:
    conn = op.get_bind()
    insp = Inspector.from_engine(conn)
    return col in {c["name"] for c in insp.get_columns(table)}


def upgrade():
    if not _col_exists("social_posts", "language"):
        op.add_column("social_posts", sa.Column("language", sa.String(8), nullable=True))

    if not _col_exists("discovery_results", "language"):
        op.add_column("discovery_results", sa.Column("language", sa.String(8), nullable=True))

    if not _col_exists("discovery_results", "llm_description"):
        op.add_column("discovery_results", sa.Column("llm_description", sa.Text, nullable=True))


def downgrade():
    op.drop_column("social_posts", "language")
    op.drop_column("discovery_results", "language")
    op.drop_column("discovery_results", "llm_description")
