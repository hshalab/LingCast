"""AI pipeline package.

Real models (GPT-SoVITS / LivePortrait) can be added later by implementing
InferencePipeline and registering the new mode in factory.create_pipeline,
without touching the S3/Redis orchestration code.
"""
