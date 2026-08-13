from django.db import migrations


def consolidate_profiles(apps, schema_editor):
    Profile = apps.get_model("repertoire", "RepertoireProfile")
    ProfileModule = apps.get_model("repertoire", "ProfileModule")
    ProfileRelease = apps.get_model("repertoire", "ProfileTemplateRelease")
    Repertoire = apps.get_model("repertoire", "Repertoire")

    owner_ids = Profile.objects.values_list("owner_id", flat=True).distinct()
    for owner_id in owner_ids:
        profiles = list(Profile.objects.filter(owner_id=owner_id).order_by("id"))
        if not profiles:
            continue
        retained = next((profile for profile in profiles if profile.name == "Default"), profiles[0])
        module_ids = list(Repertoire.objects.filter(owner_id=owner_id).order_by("id").values_list("id", flat=True))
        release_ids = list(
            ProfileRelease.objects.filter(profile__owner_id=owner_id)
            .order_by("sort_order", "id")
            .values_list("release_id", flat=True)
            .distinct()
        )
        ProfileModule.objects.filter(profile=retained).delete()
        ProfileRelease.objects.filter(profile=retained).delete()
        ProfileModule.objects.bulk_create([
            ProfileModule(profile_id=retained.id, module_id=module_id, sort_order=index, enabled=True)
            for index, module_id in enumerate(module_ids)
        ])
        ProfileRelease.objects.bulk_create([
            ProfileRelease(profile_id=retained.id, release_id=release_id, sort_order=index, enabled=True)
            for index, release_id in enumerate(release_ids)
        ])
        Profile.objects.filter(owner_id=owner_id).exclude(id=retained.id).delete()
        if retained.name != "Default":
            retained.name = "Default"
            retained.save(update_fields=["name"])


class Migration(migrations.Migration):
    dependencies = [("repertoire", "0008_remove_disabled_profile_module_memberships")]
    operations = [migrations.RunPython(consolidate_profiles, migrations.RunPython.noop)]
